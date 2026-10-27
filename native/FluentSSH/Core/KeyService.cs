using System.IO;
using System.Security.Cryptography;
using System.Text;
using Renci.SshNet;

namespace FluentSSH.Core;

/// <summary>Creates and imports local SSH keys without uploading anything.</summary>
public static class KeyService
{
    public static SshKeyRecord GenerateRsa(string name, int bits = 3072)
    {
        Directory.CreateDirectory(AppServices.Paths.KeysDirectory);
        using var rsa = RSA.Create(bits);
        var privateKey = rsa.ExportRSAPrivateKey();
        var pem = ToPem("RSA PRIVATE KEY", privateKey);
        var safe = Sanitize(name);
        var privatePath = UniquePath(Path.Combine(AppServices.Paths.KeysDirectory, safe + ".pem"));
        File.WriteAllText(privatePath, pem, new UTF8Encoding(false));

        var parameters = rsa.ExportParameters(false);
        var blob = BuildRsaPublicBlob(parameters);
        var publicBase64 = Convert.ToBase64String(blob);
        var fingerprint = "SHA256:" + Convert.ToBase64String(SHA256.HashData(blob)).TrimEnd('=');
        var publicLine = $"ssh-rsa {publicBase64} {safe}";
        File.WriteAllText(privatePath + ".pub", publicLine, new UTF8Encoding(false));

        return new SshKeyRecord
        {
            Name = name.Trim(),
            Algorithm = "RSA",
            Bits = bits,
            PublicKey = publicLine,
            Fingerprint = fingerprint,
            PrivateKeyPath = privatePath,
            GeneratedByApp = true
        };
    }

    public static SshKeyRecord Import(string sourcePath)
    {
        Directory.CreateDirectory(AppServices.Paths.KeysDirectory);
        var source = Path.GetFullPath(sourcePath);
        var target = UniquePath(Path.Combine(AppServices.Paths.KeysDirectory, Path.GetFileName(source)));
        if (!string.Equals(source, target, StringComparison.OrdinalIgnoreCase))
            File.Copy(source, target, overwrite: false);

        var name = Path.GetFileNameWithoutExtension(target);
        var header = ReadHeader(target);
        var algorithm = header switch
        {
            var h when h.Contains("OPENSSH", StringComparison.OrdinalIgnoreCase) => "OpenSSH",
            var h when h.Contains("RSA", StringComparison.OrdinalIgnoreCase) => "RSA",
            var h when h.Contains("EC", StringComparison.OrdinalIgnoreCase) => "ECDSA",
            var h when h.Contains("PRIVATE KEY", StringComparison.OrdinalIgnoreCase) => "PKCS8",
            _ => "私钥"
        };
        return new SshKeyRecord
        {
            Name = name,
            Algorithm = algorithm,
            Bits = 0,
            PublicKey = string.Empty,
            Fingerprint = string.Empty,
            PrivateKeyPath = target
        };
    }

    public static string? TryReadPublicKey(SshKeyRecord key)
    {
        if (!string.IsNullOrWhiteSpace(key.PublicKey)) return key.PublicKey;
        if (File.Exists(key.PrivateKeyPath + ".pub"))
            return File.ReadAllText(key.PrivateKeyPath + ".pub").Trim();
        return null;
    }

    private static string ReadHeader(string path)
    {
        try
        {
            foreach (var line in File.ReadLines(path).Take(4))
            {
                if (line.Contains("BEGIN", StringComparison.OrdinalIgnoreCase) &&
                    line.Contains("PRIVATE KEY", StringComparison.OrdinalIgnoreCase))
                    return line;
            }
        }
        catch
        {
            // ignore
        }
        return string.Empty;
    }

    private static string Sanitize(string name)
    {
        var trimmed = string.IsNullOrWhiteSpace(name) ? "ssh-key" : name.Trim();
        var safe = string.Concat(trimmed.Select(ch => Path.GetInvalidFileNameChars().Contains(ch) || ch == ' ' ? '-' : ch));
        return safe.Length == 0 ? "ssh-key" : safe;
    }

    private static string UniquePath(string path)
    {
        if (!File.Exists(path)) return path;
        var dir = Path.GetDirectoryName(path)!;
        var name = Path.GetFileNameWithoutExtension(path);
        var ext = Path.GetExtension(path);
        for (var i = 2; ; i++)
        {
            var candidate = Path.Combine(dir, $"{name}-{i}{ext}");
            if (!File.Exists(candidate)) return candidate;
        }
    }

    private static string ToPem(string label, byte[] data)
    {
        var base64 = Convert.ToBase64String(data);
        var builder = new StringBuilder();
        builder.AppendLine($"-----BEGIN {label}-----");
        for (var i = 0; i < base64.Length; i += 64)
            builder.AppendLine(base64.Substring(i, Math.Min(64, base64.Length - i)));
        builder.AppendLine($"-----END {label}-----");
        return builder.ToString();
    }

    private static byte[] BuildRsaPublicBlob(RSAParameters parameters)
    {
        using var stream = new MemoryStream();
        WriteString(stream, "ssh-rsa");
        WriteMpint(stream, parameters.Exponent!);
        WriteMpint(stream, parameters.Modulus!);
        return stream.ToArray();
    }

    private static void WriteString(Stream stream, string text)
    {
        var bytes = Encoding.ASCII.GetBytes(text);
        WriteUInt32(stream, (uint)bytes.Length);
        stream.Write(bytes);
    }

    private static void WriteMpint(Stream stream, byte[] value)
    {
        var start = 0;
        while (start < value.Length - 1 && value[start] == 0) start++;
        var length = value.Length - start;
        var pad = (value[start] & 0x80) != 0;
        WriteUInt32(stream, (uint)(length + (pad ? 1 : 0)));
        if (pad) stream.WriteByte(0);
        stream.Write(value, start, length);
    }

    private static void WriteUInt32(Stream stream, uint value)
    {
        stream.WriteByte((byte)(value >> 24));
        stream.WriteByte((byte)(value >> 16));
        stream.WriteByte((byte)(value >> 8));
        stream.WriteByte((byte)value);
    }

    public static bool ValidatePrivateKey(string path)
    {
        try
        {
            using var key = new PrivateKeyFile(path);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
