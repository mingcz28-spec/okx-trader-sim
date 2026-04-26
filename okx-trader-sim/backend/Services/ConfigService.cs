using OkxTraderSim.Api.Infrastructure;
using OkxTraderSim.Api.Models;
using OkxTraderSim.Api.Repositories;

namespace OkxTraderSim.Api.Services;

public sealed class ConfigService
{
    private readonly AppRepository _repository;
    private readonly EncryptionService _encryption;
    private readonly StrategyRegistryService _strategyRegistry;

    public ConfigService(AppRepository repository, EncryptionService encryption, StrategyRegistryService strategyRegistry)
    {
        _repository = repository;
        _encryption = encryption;
        _strategyRegistry = strategyRegistry;
    }

    public async Task<ApiConnectionSummaryDto> SaveOkxConfigAsync(SaveOkxConfigRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.ApiKey) || string.IsNullOrWhiteSpace(request.SecretKey) || string.IsNullOrWhiteSpace(request.Passphrase))
        {
            throw new ArgumentException("请填写完整的 OKX API Key、Secret Key 和 Passphrase。");
        }

        var doc = new ApiConnectionDocument
        {
            ApiKey = request.ApiKey.Trim(),
            EncryptedSecretKey = _encryption.Encrypt(request.SecretKey.Trim()),
            EncryptedPassphrase = _encryption.Encrypt(request.Passphrase.Trim())
        };
        await _repository.SaveApiConnectionAsync(doc);
        return AppStateService.ToApiSummary(doc);
    }

    public async Task<RiskConfigDto> GetRiskConfigAsync() =>
        AppStateService.ToRiskDto(await _repository.GetRiskConfigAsync());

    public async Task<RiskConfigDto> SaveRiskConfigAsync(RiskConfigDto dto)
    {
        var doc = new RiskConfigDocument
        {
            MaxPositionPct = dto.MaxPositionPct,
            MaxDailyLossPct = dto.MaxDailyLossPct,
            MaxConsecutiveLosses = dto.MaxConsecutiveLosses
        };
        await _repository.SaveRiskConfigAsync(doc);
        return AppStateService.ToRiskDto(doc);
    }

    public async Task<StrategyConfigDto> GetStrategyConfigAsync() =>
        AppStateService.ToStrategyDto(await _repository.GetStrategyConfigAsync());

    public async Task<StrategyConfigDto> SaveStrategyConfigAsync(StrategyConfigDto dto)
    {
        var signal = dto.LastSignal is "open_long" or "open_short" or "close" or "force_close" or "hold" ? dto.LastSignal : "hold";
        var doc = new StrategyConfigDocument
        {
            StrategyType = _strategyRegistry.NormalizeStrategyId(dto.StrategyType),
            Enabled = dto.Enabled,
            EntrySide = "buy",
            MovingAveragePeriod = dto.MovingAveragePeriod,
            StopLossPct = dto.StopLossPct,
            TrailingDrawdownPct = dto.TrailingDrawdownPct,
            Leverage = dto.Leverage,
            HighestPriceSinceEntry = dto.HighestPriceSinceEntry,
            EntryPrice = dto.EntryPrice,
            LastSignal = signal
        };
        await _repository.SaveStrategyConfigAsync(doc);
        return AppStateService.ToStrategyDto(doc);
    }
}
