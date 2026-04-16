using Microsoft.AspNetCore.Mvc;
using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Services;

namespace OkxTraderSim.Api.Controllers;

[ApiController]
[Route("api/trades/simulated")]
public sealed class TradesController : ControllerBase
{
    private readonly TradeService _service;

    public TradesController(TradeService service)
    {
        _service = service;
    }

    [HttpPost]
    public async Task<ActionResult<ApiEnvelope<AppStateDto>>> Open(SimulatedTradeRequest request)
    {
        var result = await _service.OpenSimulatedAsync(request);
        if (!result.Ok)
        {
            return BadRequest(new ApiEnvelope<AppStateDto>(false, null, result.Message, result.Code));
        }

        return Ok(new ApiEnvelope<AppStateDto>(true, result.State));
    }

    [HttpDelete]
    public async Task<ActionResult<ApiEnvelope<AppStateDto>>> CloseAll()
    {
        var state = await _service.CloseAllAsync();
        return Ok(new ApiEnvelope<AppStateDto>(true, state));
    }
}
