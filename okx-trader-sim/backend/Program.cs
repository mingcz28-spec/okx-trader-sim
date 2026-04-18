using OkxTraderSim.Api.Infrastructure;
using OkxTraderSim.Api.Repositories;
using OkxTraderSim.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddConsole();

var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrWhiteSpace(port))
{
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
}

builder.Services.Configure<MongoOptions>(builder.Configuration.GetSection("Mongo"));
builder.Services.Configure<AppSecurityOptions>(builder.Configuration.GetSection("Security"));
builder.Services.Configure<CorsOptions>(builder.Configuration.GetSection("Cors"));

builder.Services.AddSingleton<MongoDbContext>();
builder.Services.AddSingleton<AppRepository>();
builder.Services.AddSingleton<EncryptionService>();
builder.Services.AddHttpClient<OkxClient>();
builder.Services.AddScoped<AppStateService>();
builder.Services.AddScoped<ConfigService>();
builder.Services.AddScoped<TradeService>();
builder.Services.AddSingleton<StrategyRegistryService>();
builder.Services.AddScoped<BacktestService>();
builder.Services.AddScoped<OkxSyncService>();
builder.Services.AddScoped<RealtimeService>();
builder.Services.AddHostedService<RealtimeSettlementWorker>();

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var cors = builder.Configuration.GetSection("Cors").Get<CorsOptions>() ?? new CorsOptions();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(cors.AllowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
else
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
}

app.UseCors();
app.MapControllers();

if (!app.Environment.IsDevelopment())
{
    app.MapFallbackToFile("index.html");
}

app.Run();
