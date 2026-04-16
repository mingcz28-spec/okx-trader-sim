using Microsoft.AspNetCore.Mvc;
using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Services;

namespace OkxTraderSim.Api.Controllers;

[ApiController]
[Route("api/realtime")]
public sealed class RealtimeController : ControllerBase
{
    private readonly RealtimeService _service;

    public RealtimeController(RealtimeService service)
    {
        _service = service;
    }

    [HttpGet("console")]
    public async Task<ActionResult<ApiEnvelope<object>>> GetConsole()
    {
        try
        {
            var result = await _service.GetConsoleAsync();
            return Ok(new ApiEnvelope<object>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<object>(false, null, ex.Message, "REALTIME_FAILED"));
        }
    }
}
