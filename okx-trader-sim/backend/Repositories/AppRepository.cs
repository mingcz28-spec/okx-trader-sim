using MongoDB.Driver;
using OkxTraderSim.Api.Infrastructure;
using OkxTraderSim.Api.Models;

namespace OkxTraderSim.Api.Repositories;

public sealed class AppRepository
{
    private readonly MongoDbContext _db;

    public AppRepository(MongoDbContext db)
    {
        _db = db;
    }

    public async Task<AppStateDocument> GetAppStateAsync()
    {
        var state = await _db.AppState.Find(x => x.Id == DocumentIds.Default).FirstOrDefaultAsync();
        if (state != null) return state;

        state = new AppStateDocument();
        await _db.AppState.ReplaceOneAsync(x => x.Id == state.Id, state, new ReplaceOptions { IsUpsert = true });
        await SeedDefaultsAsync();
        return state;
    }

    public Task SaveAppStateAsync(AppStateDocument state)
    {
        state.Id = DocumentIds.Default;
        state.UpdatedAt = DateTime.UtcNow;
        return _db.AppState.ReplaceOneAsync(x => x.Id == state.Id, state, new ReplaceOptions { IsUpsert = true });
    }

    public async Task<ApiConnectionDocument?> GetApiConnectionAsync() =>
        await _db.ApiConnections.Find(x => x.Id == DocumentIds.Default).FirstOrDefaultAsync();

    public Task SaveApiConnectionAsync(ApiConnectionDocument config)
    {
        config.Id = DocumentIds.Default;
        config.UpdatedAt = DateTime.UtcNow;
        return _db.ApiConnections.ReplaceOneAsync(x => x.Id == config.Id, config, new ReplaceOptions { IsUpsert = true });
    }

    public async Task<RiskConfigDocument> GetRiskConfigAsync()
    {
        var config = await _db.RiskConfigs.Find(x => x.Id == DocumentIds.Default).FirstOrDefaultAsync();
        if (config != null) return config;
        config = new RiskConfigDocument();
        await SaveRiskConfigAsync(config);
        return config;
    }

    public Task SaveRiskConfigAsync(RiskConfigDocument config)
    {
        config.Id = DocumentIds.Default;
        config.UpdatedAt = DateTime.UtcNow;
        return _db.RiskConfigs.ReplaceOneAsync(x => x.Id == config.Id, config, new ReplaceOptions { IsUpsert = true });
    }

    public async Task<StrategyConfigDocument> GetStrategyConfigAsync()
    {
        var config = await _db.StrategyConfigs.Find(x => x.Id == DocumentIds.Default).FirstOrDefaultAsync();
        if (config != null) return config;
        config = new StrategyConfigDocument();
        await SaveStrategyConfigAsync(config);
        return config;
    }

    public Task SaveStrategyConfigAsync(StrategyConfigDocument config)
    {
        config.Id = DocumentIds.Default;
        if (string.IsNullOrWhiteSpace(config.StrategyType)) config.StrategyType = "buy-sell";
        config.EntrySide = "buy";
        config.UpdatedAt = DateTime.UtcNow;
        return _db.StrategyConfigs.ReplaceOneAsync(x => x.Id == config.Id, config, new ReplaceOptions { IsUpsert = true });
    }

    public Task<List<PositionDocument>> GetPositionsAsync() =>
        _db.Positions.Find(_ => true).SortByDescending(x => x.OpenedAt).ToListAsync();

    public async Task ReplacePositionsAsync(IEnumerable<PositionDocument> positions)
    {
        await _db.Positions.DeleteManyAsync(_ => true);
        var list = positions.ToList();
        if (list.Count > 0) await _db.Positions.InsertManyAsync(list);
    }

    public async Task AddPositionAsync(PositionDocument position) =>
        await _db.Positions.InsertOneAsync(position);

    public Task ClearPositionsAsync() => _db.Positions.DeleteManyAsync(_ => true);

    public Task<List<BalanceDetailDocument>> GetBalancesAsync() =>
        _db.Balances.Find(_ => true).SortBy(x => x.Ccy).ToListAsync();

    public async Task ReplaceBalancesAsync(IEnumerable<BalanceDetailDocument> balances)
    {
        await _db.Balances.DeleteManyAsync(_ => true);
        var list = balances.ToList();
        if (list.Count > 0) await _db.Balances.InsertManyAsync(list);
    }

    public Task<List<OrderHistoryDocument>> GetOrderHistoryAsync() =>
        _db.OrderHistory.Find(_ => true).SortByDescending(x => x.CreatedAt).Limit(50).ToListAsync();

    public async Task ReplaceOrderHistoryAsync(IEnumerable<OrderHistoryDocument> orders)
    {
        await _db.OrderHistory.DeleteManyAsync(_ => true);
        var list = orders.ToList();
        if (list.Count > 0) await _db.OrderHistory.InsertManyAsync(list);
    }

    public Task SaveRawOkxPayloadsAsync(RawOkxPayloadDocument raw)
    {
        raw.Id = DocumentIds.Default;
        raw.UpdatedAt = DateTime.UtcNow;
        return _db.RawOkxPayloads.ReplaceOneAsync(x => x.Id == raw.Id, raw, new ReplaceOptions { IsUpsert = true });
    }

    public async Task<BacktestDocument?> GetLatestBacktestAsync() =>
        await _db.Backtests.Find(x => x.IsLatest).SortByDescending(x => x.CreatedAt).FirstOrDefaultAsync();

    public async Task<BacktestDocument> SaveBacktestAsync(BacktestDocument backtest)
    {
        await _db.Backtests.UpdateManyAsync(x => x.IsLatest, Builders<BacktestDocument>.Update.Set(x => x.IsLatest, false));
        backtest.IsLatest = true;
        backtest.CreatedAt = DateTime.UtcNow;
        await _db.Backtests.InsertOneAsync(backtest);
        return backtest;
    }

    public async Task UpdateLatestBacktestAsync(BacktestDocument backtest)
    {
        backtest.IsLatest = true;
        if (string.IsNullOrEmpty(backtest.Id))
        {
            await SaveBacktestAsync(backtest);
            return;
        }

        await _db.Backtests.ReplaceOneAsync(x => x.Id == backtest.Id, backtest);
    }

    private async Task SeedDefaultsAsync()
    {
        if (await _db.Balances.CountDocumentsAsync(_ => true) == 0)
        {
            await _db.Balances.InsertOneAsync(new BalanceDetailDocument
            {
                Ccy = "USDT",
                Equity = 10000m,
                CashBalance = 10000m,
                AvailableBalance = 8420m
            });
        }

        if (await _db.Positions.CountDocumentsAsync(_ => true) == 0)
        {
            await _db.Positions.InsertManyAsync([
                new PositionDocument
                {
                    Id = "p1",
                    Symbol = "BTC-USDT-SWAP",
                    Side = "long",
                    Leverage = 3m,
                    Quantity = 0.012m,
                    MarginMode = "cross",
                    Notional = 100m,
                    MarginUsed = 33.33m,
                    UnrealizedPnl = 2.4m,
                    EntryPrice = 84250m,
                    MarkPrice = 86272m,
                    PnlPct = 2.4m
                },
                new PositionDocument
                {
                    Id = "p2",
                    Symbol = "ETH-USDT-SWAP",
                    Side = "short",
                    Leverage = 2m,
                    Quantity = 0.4m,
                    MarginMode = "isolated",
                    Notional = 100m,
                    MarginUsed = 50m,
                    UnrealizedPnl = -0.8m,
                    EntryPrice = 1640m,
                    MarkPrice = 1653m,
                    PnlPct = -0.8m
                }
            ]);
        }
    }
}
