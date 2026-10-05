import argparse
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile


PLACEHOLDERS = {
    "YOUTUBE_API_KEY": "your_youtube_api_key_here",
    "SSMUSIC_SERVER_URL": "https://your-ssmusic-hostname:4123/",
    "SSMUSIC_API_KEY": "your_ssmusic_search_api_key_here",
    "SSMUSIC_CA_CERT_FILE": "/app/certs/ssmusic-ca.pem",
    "DB_PASSWORD": "change_me_database_password",
    "API_ADMIN_PW": "change_me_admin_password",
    "API_MEMBER_PW": "change_me_member_password",
}


def create_environment(project_dir):
    destination = project_dir / ".env"
    if destination.exists():
        print("Keeping existing .env unchanged.")
        return
    template = (project_dir / ".env.example").read_text(encoding="utf-8-sig")
    lines = []
    written = set()
    for line in template.splitlines():
        if line.strip().startswith("# SSMUSIC_CA_CERT_FILE="):
            line = line.strip()[2:]
        key, separator, value = line.partition("=")
        key = key.strip()
        if separator and key in PLACEHOLDERS:
            line = f"{key}={PLACEHOLDERS[key]}"
            written.add(key)
        lines.append(line)
    lines.extend(f"{key}={value}" for key, value in PLACEHOLDERS.items() if key not in written)
    with destination.open("x", encoding="utf-8", newline="\n") as output:
        output.write("\n".join(lines) + "\n")
    print("Created .env with placeholder credentials. Replace them before starting the project.")


def validate_public_certificate(data):
    if b"PRIVATE KEY" in data:
        raise ValueError("Only public certificates are allowed, never private keys.")
    try:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.load_verify_locations(cadata=data.decode("ascii"))
    except (UnicodeError, ssl.SSLError, ValueError) as error:
        raise ValueError("The certificate must be a valid PEM public certificate or CA bundle.") from error


def install_certificate(project_dir, cert_file, container, container_cert_path):
    destination = project_dir / "certs" / "ssmusic-ca.pem"
    if destination.exists():
        validate_public_certificate(destination.read_bytes())
        print("Keeping existing certs/ssmusic-ca.pem unchanged.")
        return
    if cert_file is not None:
        data = cert_file.read_bytes()
    else:
        docker = shutil.which("docker")
        if docker is None:
            raise RuntimeError("Docker is unavailable. Supply a trusted public certificate with --cert-file PATH.")
        with tempfile.TemporaryDirectory(prefix="ssmusic-cert-") as temporary:
            exported = Path(temporary) / "server-cert.pem"
            try:
                subprocess.run(
                    [docker, "cp", f"{container}:{container_cert_path}", str(exported)],
                    check=True, capture_output=True, timeout=30,
                )
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
                raise RuntimeError(
                    "Could not export the ssMusic public certificate. Check --container and "
                    "--container-cert-path, or supply --cert-file PATH."
                ) from error
            data = exported.read_bytes()
    validate_public_certificate(data)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("xb") as output:
        output.write(data)
    print("Installed public certificate at certs/ssmusic-ca.pem.")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Create placeholder .env settings and install the existing ssMusic public certificate. Existing files are preserved."
    )
    parser.add_argument("--cert-file", type=Path, help="Trusted PEM certificate/CA bundle obtained from the ssMusic administrator")
    parser.add_argument("--container", default="ssmusic_server-app-1", help="Local ssMusic Docker container (default: %(default)s)")
    parser.add_argument("--container-cert-path", default="/app/data/tls/server-cert.pem", help="Public certificate inside that container (default: %(default)s)")
    args = parser.parse_args(argv)
    project_dir = Path(__file__).resolve().parent
    try:
        create_environment(project_dir)
        install_certificate(project_dir, args.cert_file, args.container, args.container_cert_path)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Initialization failed: {error}", file=sys.stderr)
        return 1
    print("Set SSMUSIC_SERVER_URL to a reachable hostname covered by the certificate.")
    print("Set SSMUSIC_API_KEY to the ssMusic server's SEARCH_API_KEY.")
    print("Docker certificate path: /app/certs/ssmusic-ca.pem; native Node needs its absolute local path.")
    print("Initialization complete. No containers were started or restarted.")
    return 0


if __name__ == "__main__":
    sys.exit(main())