using Microsoft.AspNetCore.Mvc;
using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Services;

namespace OkxTraderSim.Api.Controllers;

[ApiController]
[Route("api/backtests")]
public sealed class BacktestsController : ControllerBase
{
    private readonly BacktestService _service;

    public BacktestsController(BacktestService service)
    {
        _service = service;
    }

    [HttpGet("latest")]
    public async Task<ActionResult<ApiEnvelope<BacktestSummaryDto>>> Latest()
    {
        var result = await _service.GetLatestAsync();
        return Ok(new ApiEnvelope<BacktestSummaryDto>(true, result));
    }

    [HttpPost]
    public async Task<ActionResult<ApiEnvelope<BacktestSummaryDto>>> RunGrid(BacktestRequest request)
    {
        try
        {
            var result = await _service.RunGridAsync(request);
            return Ok(new ApiEnvelope<BacktestSummaryDto>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<BacktestSummaryDto>(false, null, ex.Message, "BACKTEST_FAILED"));
        }
    }

    [HttpPost("detail")]
    public async Task<ActionResult<ApiEnvelope<BacktestSummaryDto>>> Detail(BacktestDetailRequest request)
    {
        try
        {
            var result = await _service.RunDetailAsync(request);
            return Ok(new ApiEnvelope<BacktestSummaryDto>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<BacktestSummaryDto>(false, null, ex.Message, "BACKTEST_DETAIL_FAILED"));
        }
    }
}
