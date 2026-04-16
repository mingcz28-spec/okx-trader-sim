namespace OkxTraderSim.Api.Infrastructure;

public sealed class MongoOptions
{
    public string ConnectionString { get; set; } = "mongodb://localhost:27017";
    public string DatabaseName { get; set; } = "okx_trader_sim";
}

public sealed class AppSecurityOptions
{
    public string OkxSecretEncryptionKey { get; set; } = "replace-with-32-byte-development-key";
}

public sealed class CorsOptions
{
    public string[] AllowedOrigins { get; set; } = ["http://localhost:5173"];
}
