using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using OkxTraderSim.Api.Infrastructure;
using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Repositories;

namespace OkxTraderSim.Api.Services;

public sealed class OkxClient
{
    private const string BaseUrl = "https://www.okx.com";
    private readonly HttpClient _http;
    private readonly AppRepository _repository;
    private readonly EncryptionService _encryption;

    public OkxClient(HttpClient http, AppRepository repository, EncryptionService encryption)
    {
        _http = http;
        _repository = repository;
        _encryption = encryption;
    }

    public async Task<OkxBalanceResponse> GetBalanceAsync(string mode) =>
        await SendPrivateAsync<OkxBalanceResponse>(HttpMethod.Get, "/api/v5/account/balance", mode);

    public async Task<OkxPositionsResponse> GetPositionsAsync(string mode) =>
        await SendPrivateAsync<OkxPositionsResponse>(HttpMethod.Get, "/api/v5/account/positions", mode);

    public async Task<OkxOrdersHistoryResponse> GetOrdersHistoryAsync(string mode) =>
        await SendPrivateAsync<OkxOrdersHistoryResponse>(HttpMethod.Get, "/api/v5/trade/orders-history-archive?instType=SWAP&limit=10", mode);

    public async Task<OkxAccountConfigResponse> GetAccountConfigAsync(string mode) =>
        await SendPrivateAsync<OkxAccountConfigResponse>(HttpMethod.Get, "/api/v5/account/config", mode);

    public async Task<OkxSetLeverageResponse> SetLeverageAsync(string instId, decimal leverage, string posSide, string mode = "live")
    {
        var payload = new
        {
            instId,
            lever = leverage.ToString(CultureInfo.InvariantCulture),
            mgnMode = "cross",
            posSide
        };

        var response = await SendPrivateAsync<OkxSetLeverageResponse>(HttpMethod.Post, "/api/v5/account/set-leverage", mode, payload);
        EnsureSingleDataSuccess(response.Code, response.Msg, response.Data.FirstOrDefault()?.SCode, response.Data.FirstOrDefault()?.SMsg);
        return response;
    }

    public async Task<OkxPlaceOrderResponse> PlaceOrderAsync(OkxPlaceOrderRequest payload, string mode = "live")
    {
        var response = await SendPrivateAsync<OkxPlaceOrderResponse>(HttpMethod.Post, "/api/v5/trade/order", mode, payload);
        EnsureSingleDataSuccess(response.Code, response.Msg, response.Data.FirstOrDefault()?.SCode, response.Data.FirstOrDefault()?.SMsg);
        return response;
    }

    public async Task<OkxCancelOrderResponse> CancelOrderAsync(string instId, string orderId, string mode = "live")
    {
        var payload = new
        {
            instId,
            ordId = orderId
        };

        var response = await SendPrivateAsync<OkxCancelOrderResponse>(HttpMethod.Post, "/api/v5/trade/cancel-order", mode, payload);
        EnsureSingleDataSuccess(response.Code, response.Msg, response.Data.FirstOrDefault()?.SCode, response.Data.FirstOrDefault()?.SMsg);
        return response;
    }

    public async Task<List<CandlePointDto>> GetHistoryCandlesAsync(string instId, string bar, int limit = 100, int pages = 10)
    {
        string? after = null;
        var rows = new List<string[]>();

        for (var i = 0; i < pages; i++)
        {
            var path = $"/api/v5/market/history-candles?instId={Uri.EscapeDataString(instId)}&bar={Uri.EscapeDataString(bar)}&limit={limit}";
            if (!string.IsNullOrEmpty(after)) path += $"&after={Uri.EscapeDataString(after)}";

            var response = await _http.GetFromJsonAsync<OkxCandlesResponse>($"{BaseUrl}{path}");
            if (response?.Code != "0") throw new InvalidOperationException(response?.Msg ?? "OKX K 线读取失败");
            if (response.Data.Count == 0) break;
            rows.AddRange(response.Data);
            after = response.Data[^1][0];
        }

        return rows
            .Select(x => new CandlePointDto(ToLong(x.ElementAtOrDefault(0)), ToDecimal(x.ElementAtOrDefault(1)), ToDecimal(x.ElementAtOrDefault(2)), ToDecimal(x.ElementAtOrDefault(3)), ToDecimal(x.ElementAtOrDefault(4))))
            .OrderBy(x => x.Ts)
            .ToList();
    }

    public async Task<List<CandlePointDto>> GetMarketCandlesAsync(string instId, string bar, int limit = 2)
    {
        var safeInstId = string.IsNullOrWhiteSpace(instId) ? "BTC-USDT-SWAP" : instId.Trim().ToUpperInvariant();
        var safeLimit = Math.Clamp(limit, 1, 100);
        var path = $"/api/v5/market/candles?instId={Uri.EscapeDataString(safeInstId)}&bar={Uri.EscapeDataString(bar)}&limit={safeLimit}";
        var response = await _http.GetFromJsonAsync<OkxCandlesResponse>($"{BaseUrl}{path}");
        if (response?.Code != "0") throw new InvalidOperationException(response?.Msg ?? "OKX market candles read failed");

        return response.Data
            .Select(x => new CandlePointDto(ToLong(x.ElementAtOrDefault(0)), ToDecimal(x.ElementAtOrDefault(1)), ToDecimal(x.ElementAtOrDefault(2)), ToDecimal(x.ElementAtOrDefault(3)), ToDecimal(x.ElementAtOrDefault(4))))
            .OrderBy(x => x.Ts)
            .ToList();
    }

    public async Task<IReadOnlyList<InstrumentSuggestionDto>> SearchSwapInstrumentsAsync(string keyword, int limit = 20)
    {
        var query = (keyword ?? string.Empty).Trim().ToUpperInvariant();
        if (query.Length < 2) return [];

        var response = await _http.GetFromJsonAsync<OkxInstrumentsResponse>($"{BaseUrl}/api/v5/public/instruments?instType=SWAP");
        if (response?.Code != "0") throw new InvalidOperationException(response?.Msg ?? "OKX instrument search failed");

        return response.Data
            .Where(x => !string.IsNullOrWhiteSpace(x.InstId) && x.InstId.Contains(query, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(x => string.Equals(x.InstId, query, StringComparison.OrdinalIgnoreCase))
            .ThenBy(x => x.InstId)
            .Take(Math.Clamp(limit, 1, 50))
            .Select(x => new InstrumentSuggestionDto(x.InstId ?? string.Empty, x.BaseCcy ?? string.Empty, x.QuoteCcy ?? string.Empty, x.InstType ?? "SWAP", x.State ?? string.Empty))
            .ToList();
    }

    public async Task<OkxInstrumentData?> GetSwapInstrumentAsync(string instId)
    {
        var safeInstId = string.IsNullOrWhiteSpace(instId) ? "BTC-USDT-SWAP" : instId.Trim().ToUpperInvariant();
        var response = await _http.GetFromJsonAsync<OkxInstrumentsResponse>($"{BaseUrl}/api/v5/public/instruments?instType=SWAP&instId={Uri.EscapeDataString(safeInstId)}");
        if (response?.Code != "0") throw new InvalidOperationException(response?.Msg ?? "OKX instrument read failed");
        return response.Data.FirstOrDefault();
    }

    public async Task<decimal?> GetLatestPriceAsync(string instId)
    {
        var book = await GetOrderBookAsync(instId, 1);
        var data = book.Data.FirstOrDefault();
        if (data is null) return null;

        var bid = ToDecimal(data.Bids.FirstOrDefault()?.ElementAtOrDefault(0));
        var ask = ToDecimal(data.Asks.FirstOrDefault()?.ElementAtOrDefault(0));
        if (bid > 0 && ask > 0) return (bid + ask) / 2m;
        if (bid > 0) return bid;
        if (ask > 0) return ask;
        return null;
    }

    public async Task<OkxOrderBookResponse> GetOrderBookAsync(string instId, int size = 20)
    {
        var safeInstId = string.IsNullOrWhiteSpace(instId) ? "BTC-USDT-SWAP" : instId.Trim().ToUpperInvariant();
        var safeSize = Math.Clamp(size, 1, 400);
        var path = $"/api/v5/market/books?instId={Uri.EscapeDataString(safeInstId)}&sz={safeSize}";
        var response = await _http.GetFromJsonAsync<OkxOrderBookResponse>($"{BaseUrl}{path}");
        if (response?.Code != "0") throw new InvalidOperationException(response?.Msg ?? "OKX order book read failed");
        return response;
    }

    public static string BuildSignature(string timestamp, string method, string requestPath, string body, string secretKey)
    {
        var prehash = $"{timestamp}{method.ToUpperInvariant()}{requestPath}{body}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secretKey));
        return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(prehash)));
    }

    private async Task<T> SendPrivateAsync<T>(HttpMethod method, string requestPath, string mode, object? payload = null)
    {
        var config = await _repository.GetApiConnectionAsync();
        if (config is null || string.IsNullOrWhiteSpace(config.ApiKey) || string.IsNullOrWhiteSpace(config.EncryptedSecretKey) || string.IsNullOrWhiteSpace(config.EncryptedPassphrase))
        {
            throw new InvalidOperationException("请先填写完整的 OKX API Key、Secret Key 和 Passphrase。");
        }

        var secret = _encryption.Decrypt(config.EncryptedSecretKey);
        var passphrase = _encryption.Decrypt(config.EncryptedPassphrase);
        var body = payload is null ? string.Empty : JsonSerializer.Serialize(payload, JsonOptions);
        var timestamp = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
        var request = new HttpRequestMessage(method, $"{BaseUrl}{requestPath}");
        request.Headers.Add("OK-ACCESS-KEY", config.ApiKey);
        request.Headers.Add("OK-ACCESS-SIGN", BuildSignature(timestamp, method.Method, requestPath, body, secret));
        request.Headers.Add("OK-ACCESS-TIMESTAMP", timestamp);
        request.Headers.Add("OK-ACCESS-PASSPHRASE", passphrase);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (mode == "demo") request.Headers.Add("x-simulated-trading", "1");
        if (!string.IsNullOrEmpty(body))
        {
            request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        }

        using var response = await _http.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"OKX 请求失败: {(int)response.StatusCode} {response.ReasonPhrase}");
        }

        var json = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<T>(json, JsonOptions) ?? throw new InvalidOperationException("OKX 响应解析失败");
    }

    private static void EnsureSingleDataSuccess(string? code, string? msg, string? sCode, string? sMsg)
    {
        if (!string.Equals(code, "0", StringComparison.Ordinal))
        {
            throw new InvalidOperationException(msg ?? "OKX request failed");
        }

        if (!string.IsNullOrWhiteSpace(sCode) && !string.Equals(sCode, "0", StringComparison.Ordinal))
        {
            throw new InvalidOperationException(sMsg ?? $"OKX request failed: {sCode}");
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static decimal ToDecimal(string? value) =>
        decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var n) ? n : 0m;

    private static long ToLong(string? value) =>
        long.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var n) ? n : 0L;
}

public sealed class OkxBalanceResponse
{
    [JsonPropertyName("code")] public string Code { get; set; } = string.Empty;
    [JsonPropertyName("msg")] public string Msg { get; set; } = string.Empty;
    [JsonPropertyName("data")] public List<OkxBalanceData> Data { get; set; } = [];
}

public sealed class OkxBalanceData
{
    [JsonPropertyName("totalEq")] public string? TotalEq { get; set; }
    [JsonPropertyName("adjEq")] public string? AdjEq { get; set; }
    [JsonPropertyName("details")] public List<OkxBalanceDetail> Details { get; set; } = [];
}

public sealed class OkxBalanceDetail
{
    [JsonPropertyName("availBal")] public string? AvailBal { get; set; }
    [JsonPropertyName("ccy")] public string? Ccy { get; set; }
    [JsonPropertyName("cashBal")] public string? CashBal { get; set; }
    [JsonPropertyName("eq")] public string? Eq { get; set; }
}

public sealed class OkxPositionsResponse
{
    [JsonPropertyName("code")] public string Code { get; set; } = string.Empty;
    [JsonPropertyName("msg")] public string Msg { get; set; } = string.Empty;
    [JsonPropertyName("data")] public List<OkxPositionData> Data { get; set; } = [];
}

public sealed class OkxPositionData
{
    [JsonPropertyName("instId")] public string? InstId { get; set; }
    [JsonPropertyName("posSide")] public string? PosSide { get; set; }
    [JsonPropertyName("lever")] public string? Lever { get; set; }
    [JsonPropertyName("mgnMode")] public string? MgnMode { get; set; }
    [JsonPropertyName("notionalUsd")] public string? NotionalUsd { get; set; }
    [JsonPropertyName("margin")] public string? Margin { get; set; }
    [JsonPropertyName("avgPx")] public string? AvgPx { get; set; }
    [JsonPropertyName("markPx")] public string? MarkPx { get; set; }
    [JsonPropertyName("uplRatio")] public string? UplRatio { get; set; }
    [JsonPropertyName("upl")] public string? Upl { get; set; }
    [JsonPropertyName("cTime")] public string? CTime { get; set; }
    [JsonPropertyName("pos")] public string? Pos { get; set; }
}

public sealed class OkxOrdersHistoryResponse
{
    [JsonPropertyName("code")] public string Code { get; set; } = string.Empty;
    [JsonPropertyName("msg")] public string Msg { get; set; } = string.Empty;
    [JsonPropertyName("data")] public List<OkxOrderData> Data { get; set; } = [];
}

public sealed class OkxOrderData
{
    [JsonPropertyName("ordId")] public string? OrdId { get; set; }
    [JsonPropertyName("instId")] public string? InstId { get; set; }
    [JsonPropertyName("side")] public string? Side { get; set; }
    [JsonPropertyName("ordType")] public string? OrdType { get; set; }
    [JsonPropertyName("state")] public string? State { get; set; }
    [JsonPropertyName("px")] public string? Px { get; set; }
    [JsonPropertyName("sz")] public string? Sz { get; set; }
    [JsonPropertyName("accFillSz")] public string? AccFillSz { get; set; }
    [JsonPropertyName("cTime")] public string? CTime { get; set; }
}

public sealed class OkxCandlesResponse
{
    [JsonPropertyName("code")] public string Code { get; set; } = string.Empty;
    [JsonPropertyName("msg")] public string Msg { get; set; } = string.Empty;
    [JsonPropertyName("data")] public List<string[]> Data { get; set; } = [];
}

public sealed class OkxOrderBookResponse
{
    [JsonPropertyName("code")] public string Code { get; set; } = string.Empty;
    [JsonPropertyName("msg")] public string Msg { get; set; } = string.Empty;
    [JsonPropertyName("data")] public List<OkxOrderBookData> Data { get; set; } = [];
}

public sealed class OkxOrderBookData
{
    [JsonPropertyName("asks")] public List<string[]> Asks { get; set; } = [];
    [JsonPropertyName("bids")] public List<string[]> Bids { get; set; } = [];
    [JsonPropertyName("ts")] public string? Ts { get; set; }
}

public sealed class OkxInstrumentsResponse
{
    [JsonPropertyName("code")] public string Code { get; set; } = string.Empty;
    [JsonPropertyName("msg")] public string Msg { get; set; } = string.Empty;
    [JsonPropertyName("data")] public List<OkxInstrumentData> Data { get; set; } = [];
}

public sealed class OkxInstrumentData
{
    [JsonPropertyName("instType")] public string? InstType { get; set; }
    [JsonPropertyName("instId")] public string? InstId { get; set; }
    [JsonPropertyName("baseCcy")] public string? BaseCcy { get; set; }
    [JsonPropertyName("quoteCcy")] public string? QuoteCcy { get; set; }
    [JsonPropertyName("state")] public string? State { get; set; }
    [JsonPropertyName("minSz")] public string? MinSz { get; set; }
    [JsonPropertyName("lotSz")] public string? LotSz { get; set; }
    [JsonPropertyName("ctVal")] public string? CtVal { get; set; }
}

public sealed class OkxAccountConfigResponse
{
    [JsonPropertyName("code")] public string Code { get; set; } = string.Empty;
    [JsonPropertyName("msg")] public string Msg { get; set; } = string.Empty;
    [JsonPropertyName("data")] public List<OkxAccountConfigData> Data { get; set; } = [];
}

public sealed class OkxAccountConfigData
{
    [JsonPropertyName("posMode")] public string? PosMode { get; set; }
    [JsonPropertyName("acctLv")] public string? AcctLv { get; set; }
    [JsonPropertyName("greeksType")] public string? GreeksType { get; set; }
    [JsonPropertyName("level")] public string? Level { get; set; }
}

public sealed class OkxSetLeverageResponse
{
    [JsonPropertyName("code")] public string Code { get; set; } = string.Empty;
    [JsonPropertyName("msg")] public string Msg { get; set; } = string.Empty;
    [JsonPropertyName("data")] public List<OkxSetLeverageData> Data { get; set; } = [];
}

public sealed class OkxSetLeverageData
{
    [JsonPropertyName("lever")] public string? Lever { get; set; }
    [JsonPropertyName("mgnMode")] public string? MgnMode { get; set; }
    [JsonPropertyName("instId")] public string? InstId { get; set; }
    [JsonPropertyName("posSide")] public string? PosSide { get; set; }
    [JsonPropertyName("sCode")] public string? SCode { get; set; }
    [JsonPropertyName("sMsg")] public string? SMsg { get; set; }
}

public sealed class OkxPlaceOrderRequest
{
    [JsonPropertyName("instId")] public string InstId { get; set; } = string.Empty;
    [JsonPropertyName("tdMode")] public string TdMode { get; set; } = "cross";
    [JsonPropertyName("side")] public string Side { get; set; } = string.Empty;
    [JsonPropertyName("posSide")] public string PosSide { get; set; } = string.Empty;
    [JsonPropertyName("ordType")] public string OrdType { get; set; } = "market";
    [JsonPropertyName("sz")] public string Size { get; set; } = "1";
    [JsonPropertyName("reduceOnly")] public bool? ReduceOnly { get; set; }
}

public sealed class OkxPlaceOrderResponse
{
    [JsonPropertyName("code")] public string Code { get; set; } = string.Empty;
    [JsonPropertyName("msg")] public string Msg { get; set; } = string.Empty;
    [JsonPropertyName("data")] public List<OkxPlaceOrderData> Data { get; set; } = [];
}

public sealed class OkxPlaceOrderData
{
    [JsonPropertyName("ordId")] public string? OrdId { get; set; }
    [JsonPropertyName("clOrdId")] public string? ClOrdId { get; set; }
    [JsonPropertyName("tag")] public string? Tag { get; set; }
    [JsonPropertyName("sCode")] public string? SCode { get; set; }
    [JsonPropertyName("sMsg")] public string? SMsg { get; set; }
}

public sealed class OkxCancelOrderResponse
{
    [JsonPropertyName("code")] public string Code { get; set; } = string.Empty;
    [JsonPropertyName("msg")] public string Msg { get; set; } = string.Empty;
    [JsonPropertyName("data")] public List<OkxCancelOrderData> Data { get; set; } = [];
}

public sealed class OkxCancelOrderData
{
    [JsonPropertyName("ordId")] public string? OrdId { get; set; }
    [JsonPropertyName("sCode")] public string? SCode { get; set; }
    [JsonPropertyName("sMsg")] public string? SMsg { get; set; }
}
