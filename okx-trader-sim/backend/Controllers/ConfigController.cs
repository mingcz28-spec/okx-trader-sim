using Microsoft.AspNetCore.Mvc;
using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Services;

namespace OkxTraderSim.Api.Controllers;

[ApiController]
public sealed class ConfigController : ControllerBase
{
    private readonly ConfigService _service;

    public ConfigController(ConfigService service)
    {
        _service = service;
    }

    [HttpPost("api/config/okx")]
    public async Task<ActionResult<ApiEnvelope<ApiConnectionSummaryDto>>> SaveOkxConfig(SaveOkxConfigRequest request)
    {
        try
        {
            var summary = await _service.SaveOkxConfigAsync(request);
            return Ok(new ApiEnvelope<ApiConnectionSummaryDto>(true, summary));
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new ApiEnvelope<ApiConnectionSummaryDto>(false, null, ex.Message, "OKX_CONFIG_INVALID"));
        }
    }

    [HttpGet("api/risk-config")]
    public async Task<ActionResult<RiskConfigDto>> GetRiskConfig() => await _service.GetRiskConfigAsync();

    [HttpPut("api/risk-config")]
    public async Task<ActionResult<ApiEnvelope<RiskConfigDto>>> SaveRiskConfig(RiskConfigDto request)
    {
        var result = await _service.SaveRiskConfigAsync(request);
        return Ok(new ApiEnvelope<RiskConfigDto>(true, result));
    }

    [HttpGet("api/strategy-config")]
    public async Task<ActionResult<StrategyConfigDto>> GetStrategyConfig() => await _service.GetStrategyConfigAsync();

    [HttpPut("api/strategy-config")]
    public async Task<ActionResult<ApiEnvelope<StrategyConfigDto>>> SaveStrategyConfig(StrategyConfigDto request)
    {
        var result = await _service.SaveStrategyConfigAsync(request);
        return Ok(new ApiEnvelope<StrategyConfigDto>(true, result));
    }
}
