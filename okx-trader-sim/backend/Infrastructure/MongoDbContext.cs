using Microsoft.Extensions.Options;
using MongoDB.Driver;
using OkxTraderSim.Api.Models;

namespace OkxTraderSim.Api.Infrastructure;

public sealed class MongoDbContext
{
    public MongoDbContext(IOptions<MongoOptions> options)
    {
        var client = new MongoClient(options.Value.ConnectionString);
        Database = client.GetDatabase(options.Value.DatabaseName);
    }

    public IMongoDatabase Database { get; }

    public IMongoCollection<AppStateDocument> AppState => Database.GetCollection<AppStateDocument>("appState");
    public IMongoCollection<ApiConnectionDocument> ApiConnections => Database.GetCollection<ApiConnectionDocument>("apiConnections");
    public IMongoCollection<RiskConfigDocument> RiskConfigs => Database.GetCollection<RiskConfigDocument>("riskConfigs");
    public IMongoCollection<StrategyConfigDocument> StrategyConfigs => Database.GetCollection<StrategyConfigDocument>("strategyConfigs");
    public IMongoCollection<PositionDocument> Positions => Database.GetCollection<PositionDocument>("positions");
    public IMongoCollection<BalanceDetailDocument> Balances => Database.GetCollection<BalanceDetailDocument>("balances");
    public IMongoCollection<OrderHistoryDocument> OrderHistory => Database.GetCollection<OrderHistoryDocument>("orderHistory");
    public IMongoCollection<BacktestDocument> Backtests => Database.GetCollection<BacktestDocument>("backtests");
    public IMongoCollection<RawOkxPayloadDocument> RawOkxPayloads => Database.GetCollection<RawOkxPayloadDocument>("rawOkxPayloads");
}
