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

    public async Task<OkxBalanceResponse> GetBalanceAsync(string mode)
    {
        return await GetPrivateAsync<OkxBalanceResponse>("/api/v5/account/balance", mode);
    }

    public async Task<OkxPositionsResponse> GetPositionsAsync(string mode)
    {
        return await GetPrivateAsync<OkxPositionsResponse>("/api/v5/account/positions", mode);
    }

    public async Task<OkxOrdersHistoryResponse> GetOrdersHistoryAsync(string mode)
    {
        return await GetPrivateAsync<OkxOrdersHistoryResponse>("/api/v5/trade/orders-history-archive?instType=SWAP&limit=10", mode);
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
            if (response?.Code != "0") throw new InvalidOperationException(response?.Msg ?? "OKX K线读取失败");
            if (response.Data.Count == 0) break;
            rows.AddRange(response.Data);
            after = response.Data[^1][0];
        }

        return rows
            .Select(x => new CandlePointDto(ToLong(x.ElementAtOrDefault(0)), ToDecimal(x.ElementAtOrDefault(1)), ToDecimal(x.ElementAtOrDefault(2)), ToDecimal(x.ElementAtOrDefault(3)), ToDecimal(x.ElementAtOrDefault(4))))
            .OrderBy(x => x.Ts)
            .ToList();
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

    private async Task<T> GetPrivateAsync<T>(string requestPath, string mode)
    {
        var config = await _repository.GetApiConnectionAsync();
        if (config is null || string.IsNullOrWhiteSpace(config.ApiKey) || string.IsNullOrWhiteSpace(config.EncryptedSecretKey) || string.IsNullOrWhiteSpace(config.EncryptedPassphrase))
        {
            throw new InvalidOperationException("请先填写完整的 OKX API Key、Secret Key 和 Passphrase。");
        }

        var secret = _encryption.Decrypt(config.EncryptedSecretKey);
        var passphrase = _encryption.Decrypt(config.EncryptedPassphrase);
        var timestamp = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
        var request = new HttpRequestMessage(HttpMethod.Get, $"{BaseUrl}{requestPath}");
        request.Headers.Add("OK-ACCESS-KEY", config.ApiKey);
        request.Headers.Add("OK-ACCESS-SIGN", BuildSignature(timestamp, "GET", requestPath, string.Empty, secret));
        request.Headers.Add("OK-ACCESS-TIMESTAMP", timestamp);
        request.Headers.Add("OK-ACCESS-PASSPHRASE", passphrase);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (mode == "demo") request.Headers.Add("x-simulated-trading", "1");

        using var response = await _http.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"OKX 请求失败: {(int)response.StatusCode} {response.ReasonPhrase}");
        }

        var json = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<T>(json, JsonOptions) ?? throw new InvalidOperationException("OKX 响应解析失败");
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
