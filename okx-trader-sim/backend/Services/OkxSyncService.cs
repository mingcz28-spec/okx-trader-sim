using System.Globalization;
using System.Text.Json;
using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Repositories;

namespace OkxTraderSim.Api.Services;

public sealed class OkxSyncService
{
    private readonly OkxClient _client;
    private readonly AppRepository _repository;
    private readonly AppStateService _stateService;

    public OkxSyncService(OkxClient client, AppRepository repository, AppStateService stateService)
    {
        _client = client;
        _repository = repository;
        _stateService = stateService;
    }

    public async Task<object> TestConnectionAsync(string mode)
    {
        var balanceRes = await _client.GetBalanceAsync(NormalizeMode(mode));
        if (balanceRes.Code != "0") throw new InvalidOperationException(balanceRes.Msg);
        var balance = balanceRes.Data.FirstOrDefault();
        var detail = balance?.Details.FirstOrDefault(x => x.Ccy == "USDT") ?? balance?.Details.FirstOrDefault();

        return new
        {
            mode,
            totalEq = ToDecimal(balance?.TotalEq),
            availableBalance = ToDecimal(detail?.AvailBal ?? detail?.CashBal ?? detail?.Eq)
        };
    }

    public async Task<OrderBookDto> GetOrderBookAsync(string instId, int size)
    {
        instId = string.IsNullOrWhiteSpace(instId) ? "BTC-USDT-SWAP" : instId.Trim().ToUpperInvariant();
        var response = await _client.GetOrderBookAsync(instId, size);
        var book = response.Data.FirstOrDefault() ?? new OkxOrderBookData();
        var updatedAt = ToDateTime(book.Ts);

        return new OrderBookDto(
            instId,
            updatedAt,
            ToLevels(book.Bids),
            ToLevels(book.Asks));
    }

    public async Task<AppStateDto> SyncAsync(string mode)
    {
        mode = NormalizeMode(mode);
        var balanceTask = _client.GetBalanceAsync(mode);
        var positionsTask = _client.GetPositionsAsync(mode);
        var ordersTask = _client.GetOrdersHistoryAsync(mode);
        await Task.WhenAll(balanceTask, positionsTask, ordersTask);

        var balanceRes = await balanceTask;
        var positionsRes = await positionsTask;
        var ordersRes = await ordersTask;
        if (balanceRes.Code != "0") throw new InvalidOperationException(balanceRes.Msg);
        if (positionsRes.Code != "0") throw new InvalidOperationException(positionsRes.Msg);

        var balance = balanceRes.Data.FirstOrDefault();
        var usdt = balance?.Details.FirstOrDefault(x => x.Ccy == "USDT") ?? balance?.Details.FirstOrDefault();
        var state = await _repository.GetAppStateAsync();
        state.CurrencyMode = "USD";
        state.Equity = ToDecimal(balance?.TotalEq, state.Equity);
        state.AvailableMargin = ToDecimal(usdt?.AvailBal ?? usdt?.CashBal ?? usdt?.Eq, state.AvailableMargin);

        var balances = (balance?.Details ?? new List<OkxBalanceDetail>())
            .Select(x => new BalanceDetailDocument
            {
                Ccy = string.IsNullOrWhiteSpace(x.Ccy) ? "UNKNOWN" : x.Ccy,
                Equity = ToDecimal(x.Eq),
                CashBalance = ToDecimal(x.CashBal),
                AvailableBalance = ToDecimal(x.AvailBal),
                UpdatedAt = DateTime.UtcNow
            })
            .ToList();
        await _repository.ReplaceBalancesAsync(balances);

        var positions = positionsRes.Data.Select((x, index) => new PositionDocument
        {
            Id = string.IsNullOrWhiteSpace(x.InstId) ? $"okx-{index}" : $"{x.InstId}-{index}",
            Symbol = string.IsNullOrWhiteSpace(x.InstId) ? "UNKNOWN" : x.InstId,
            Side = x.PosSide == "short" ? "short" : "long",
            Leverage = ToDecimal(x.Lever, 1m),
            MarginMode = x.MgnMode ?? "unknown",
            Quantity = Math.Abs(ToDecimal(x.Pos)),
            Notional = Math.Abs(ToDecimal(x.NotionalUsd ?? x.Pos)),
            MarginUsed = Math.Abs(ToDecimal(x.Margin)),
            UnrealizedPnl = ToDecimal(x.Upl),
            EntryPrice = ToDecimal(x.AvgPx),
            MarkPrice = ToDecimal(x.MarkPx),
            PnlPct = Math.Round(ToDecimal(x.UplRatio) * 100m, 2),
            OpenedAt = ToDateTime(x.CTime)
        }).ToList();
        await _repository.ReplacePositionsAsync(positions);

        state.DailyPnl = Math.Round(positions.Sum(x => x.Notional * x.PnlPct / 100m), 2);
        state.DrawdownPct = positions.Count == 0 ? 0m : Math.Min(0m, positions.Min(x => x.PnlPct));
        state.StrategyStatus = positions.Count == 0 ? "idle" : "running";
        await _repository.SaveAppStateAsync(state);

        var orders = ordersRes.Data.Select((x, index) => new OrderHistoryDocument
        {
            Id = x.OrdId ?? $"ord-{index}",
            Symbol = x.InstId ?? "UNKNOWN",
            Side = x.Side ?? "unknown",
            OrderType = x.OrdType ?? "unknown",
            State = x.State ?? "unknown",
            Price = ToDecimal(x.Px),
            Size = ToDecimal(x.Sz),
            FilledSize = ToDecimal(x.AccFillSz),
            CreatedAt = ToDateTime(x.CTime)
        }).ToList();
        await _repository.ReplaceOrderHistoryAsync(orders);

        await _repository.SaveRawOkxPayloadsAsync(new RawOkxPayloadDocument
        {
            AccountBalance = JsonSerializer.Serialize(balanceRes),
            AccountPositions = JsonSerializer.Serialize(positionsRes),
            OrdersHistory = JsonSerializer.Serialize(ordersRes)
        });

        return await _stateService.GetStateAsync();
    }

    private static string NormalizeMode(string? mode) => mode == "live" ? "live" : "demo";

    private static decimal ToDecimal(string? value, decimal fallback = 0m) =>
        decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var n) ? n : fallback;

    private static DateTime ToDateTime(string? millis)
    {
        if (long.TryParse(millis, out var ms))
        {
            return DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime;
        }

        return DateTime.UtcNow;
    }

    private static List<OrderBookLevelDto> ToLevels(List<string[]> rows)
    {
        var total = 0m;
        return rows.Select(row =>
        {
            var price = ToDecimal(row.ElementAtOrDefault(0));
            var size = ToDecimal(row.ElementAtOrDefault(1));
            total += size;
            return new OrderBookLevelDto(price, size, total, (int)ToDecimal(row.ElementAtOrDefault(3)));
        }).ToList();
    }
}
