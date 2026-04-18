using Microsoft.AspNetCore.Mvc;
using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Services;

namespace OkxTraderSim.Api.Controllers;

[ApiController]
[Route("api/okx")]
public sealed class OkxController : ControllerBase
{
    private readonly OkxSyncService _service;

    public OkxController(OkxSyncService service)
    {
        _service = service;
    }

    [HttpPost("test-connection")]
    public async Task<ActionResult<ApiEnvelope<object>>> TestConnection(OkxModeRequest request)
    {
        try
        {
            var result = await _service.TestConnectionAsync(request.Mode ?? "demo");
            return Ok(new ApiEnvelope<object>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<object>(false, null, ex.Message, "OKX_TEST_FAILED"));
        }
    }

    [HttpGet("account-config")]
    public async Task<ActionResult<ApiEnvelope<OkxAccountConfigDto>>> GetAccountConfig([FromQuery] string? mode)
    {
        try
        {
            var result = await _service.GetAccountConfigAsync(mode ?? "live");
            return Ok(new ApiEnvelope<OkxAccountConfigDto>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<OkxAccountConfigDto>(false, null, ex.Message, "OKX_ACCOUNT_CONFIG_FAILED"));
        }
    }

    [HttpPost("sync")]
    public async Task<ActionResult<ApiEnvelope<AppStateDto>>> Sync(OkxModeRequest request)
    {
        try
        {
            var result = await _service.SyncAsync(request.Mode ?? "demo");
            return Ok(new ApiEnvelope<AppStateDto>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<AppStateDto>(false, null, ex.Message, "OKX_SYNC_FAILED"));
        }
    }

    [HttpGet("orderbook")]
    public async Task<ActionResult<ApiEnvelope<OrderBookDto>>> GetOrderBook([FromQuery] string? instId, [FromQuery] int? size)
    {
        try
        {
            var result = await _service.GetOrderBookAsync(instId ?? "BTC-USDT-SWAP", size ?? 20);
            return Ok(new ApiEnvelope<OrderBookDto>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<OrderBookDto>(false, null, ex.Message, "OKX_ORDERBOOK_FAILED"));
        }
    }
}
