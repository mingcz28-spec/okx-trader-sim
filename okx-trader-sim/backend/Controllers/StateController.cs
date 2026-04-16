using Microsoft.AspNetCore.Mvc;
using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Services;

namespace OkxTraderSim.Api.Controllers;

[ApiController]
[Route("api/state")]
public sealed class StateController : ControllerBase
{
    private readonly AppStateService _service;

    public StateController(AppStateService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<ActionResult<AppStateDto>> Get() => await _service.GetStateAsync();
}
