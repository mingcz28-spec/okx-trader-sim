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

    [HttpGet("instruments")]
    public async Task<ActionResult<ApiEnvelope<IReadOnlyList<InstrumentSuggestionDto>>>> SearchInstruments([FromQuery] string? q)
    {
        try
        {
            var result = await _service.SearchInstrumentsAsync(q);
            return Ok(new ApiEnvelope<IReadOnlyList<InstrumentSuggestionDto>>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<IReadOnlyList<InstrumentSuggestionDto>>(false, null, ex.Message, "REALTIME_INSTRUMENTS_FAILED"));
        }
    }

    [HttpGet("workspace")]
    public async Task<ActionResult<ApiEnvelope<RealtimeWorkspaceDto>>> GetWorkspace([FromQuery] string? instId, [FromQuery] string? bar, [FromQuery] string? strategyType, [FromQuery] bool? confirmed)
    {
        try
        {
            var result = await _service.GetWorkspaceAsync(new RealtimeWorkspaceRequest(instId, bar, strategyType, confirmed));
            return Ok(new ApiEnvelope<RealtimeWorkspaceDto>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<RealtimeWorkspaceDto>(false, null, ex.Message, "REALTIME_WORKSPACE_FAILED"));
        }
    }

    [HttpGet("live-reconciliation")]
    public async Task<ActionResult<ApiEnvelope<RealtimeTradingSummaryDto?>>> GetLiveReconciliation()
    {
        try
        {
            var result = await _service.GetLiveReconciliationAsync();
            return Ok(new ApiEnvelope<RealtimeTradingSummaryDto?>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<RealtimeTradingSummaryDto?>(false, null, ex.Message, "REALTIME_LIVE_RECONCILIATION_FAILED"));
        }
    }

    [HttpPut("session")]
    public async Task<ActionResult<ApiEnvelope<RealtimeWorkspaceDto>>> ConfirmSession([FromBody] ConfirmRealtimeSessionRequest request)
    {
        try
        {
            var result = await _service.ConfirmSessionAsync(request);
            return Ok(new ApiEnvelope<RealtimeWorkspaceDto>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<RealtimeWorkspaceDto>(false, null, ex.Message, "REALTIME_SESSION_FAILED"));
        }
    }

    [HttpPut("session/force-exit")]
    public async Task<ActionResult<ApiEnvelope<RealtimeWorkspaceDto>>> ForceExit()
    {
        try
        {
            var result = await _service.ForceExitAsync();
            return Ok(new ApiEnvelope<RealtimeWorkspaceDto>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<RealtimeWorkspaceDto>(false, null, ex.Message, "REALTIME_FORCE_EXIT_FAILED"));
        }
    }

    [HttpPut("live-session")]
    public async Task<ActionResult<ApiEnvelope<RealtimeWorkspaceDto>>> PutLiveSession([FromBody] LiveRealtimeSessionRequest request)
    {
        try
        {
            var result = await _service.PutLiveSessionAsync(request);
            return Ok(new ApiEnvelope<RealtimeWorkspaceDto>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<RealtimeWorkspaceDto>(false, null, ex.Message, "REALTIME_LIVE_SESSION_FAILED"));
        }
    }

    [HttpPut("live-session/pause")]
    public async Task<ActionResult<ApiEnvelope<RealtimeWorkspaceDto>>> PauseLiveSession()
    {
        try
        {
            var result = await _service.PauseLiveSessionAsync();
            return Ok(new ApiEnvelope<RealtimeWorkspaceDto>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<RealtimeWorkspaceDto>(false, null, ex.Message, "REALTIME_LIVE_SESSION_PAUSE_FAILED"));
        }
    }

    [HttpPut("live-session/resume")]
    public async Task<ActionResult<ApiEnvelope<RealtimeWorkspaceDto>>> ResumeLiveSession()
    {
        try
        {
            var result = await _service.ResumeLiveSessionAsync();
            return Ok(new ApiEnvelope<RealtimeWorkspaceDto>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<RealtimeWorkspaceDto>(false, null, ex.Message, "REALTIME_LIVE_SESSION_RESUME_FAILED"));
        }
    }

    [HttpPut("live-session/force-exit")]
    public async Task<ActionResult<ApiEnvelope<RealtimeWorkspaceDto>>> ForceExitLiveSession()
    {
        try
        {
            var result = await _service.ForceExitLiveSessionAsync();
            return Ok(new ApiEnvelope<RealtimeWorkspaceDto>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<RealtimeWorkspaceDto>(false, null, ex.Message, "REALTIME_LIVE_SESSION_FORCE_EXIT_FAILED"));
        }
    }

    [HttpDelete("live-session")]
    public async Task<ActionResult<ApiEnvelope<RealtimeWorkspaceDto>>> DeleteLiveSession()
    {
        try
        {
            var result = await _service.DeleteLiveSessionAsync();
            return Ok(new ApiEnvelope<RealtimeWorkspaceDto>(true, result));
        }
        catch (Exception ex)
        {
            return BadRequest(new ApiEnvelope<RealtimeWorkspaceDto>(false, null, ex.Message, "REALTIME_LIVE_SESSION_DELETE_FAILED"));
        }
    }
}
