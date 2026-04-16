using Microsoft.AspNetCore.Mvc;
using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Services;

namespace OkxTraderSim.Api.Controllers;

[ApiController]
[Route("api/strategies")]
public sealed class StrategiesController : ControllerBase
{
    private readonly StrategyRegistryService _registry;

    public StrategiesController(StrategyRegistryService registry)
    {
        _registry = registry;
    }

    [HttpGet]
    public ActionResult<ApiEnvelope<IReadOnlyList<StrategyDefinitionDto>>> List()
    {
        return Ok(new ApiEnvelope<IReadOnlyList<StrategyDefinitionDto>>(true, _registry.GetDefinitions()));
    }
}
