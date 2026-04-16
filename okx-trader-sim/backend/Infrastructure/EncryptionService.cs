using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace OkxTraderSim.Api.Infrastructure;

public sealed class EncryptionService
{
    private readonly byte[] _key;

    public EncryptionService(IOptions<AppSecurityOptions> options)
    {
        var configured = options.Value.OkxSecretEncryptionKey;
        _key = SHA256.HashData(Encoding.UTF8.GetBytes(configured));
    }

    public string Encrypt(string value)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;

        var nonce = RandomNumberGenerator.GetBytes(12);
        var plain = Encoding.UTF8.GetBytes(value);
        var cipher = new byte[plain.Length];
        var tag = new byte[16];

        using var aes = new AesGcm(_key, tag.Length);
        aes.Encrypt(nonce, plain, cipher, tag);

        return Convert.ToBase64String(nonce.Concat(tag).Concat(cipher).ToArray());
    }

    public string Decrypt(string value)
    {
        if (string.IsNullOrEmpty(value)) return string.Empty;

        var payload = Convert.FromBase64String(value);
        var nonce = payload[..12];
        var tag = payload[12..28];
        var cipher = payload[28..];
        var plain = new byte[cipher.Length];

        using var aes = new AesGcm(_key, tag.Length);
        aes.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }
}
