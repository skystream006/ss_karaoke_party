import contextlib
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import _initialize_project as initialize


class InitializeProjectTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name)
        self.certificate = self.project / "certs" / "ssmusic-ca.pem"
        self.addCleanup(patch.stopall)
        self.output = io.StringIO()
        self.redirect = contextlib.redirect_stdout(self.output)
        self.redirect.__enter__()
        self.addCleanup(self.redirect.__exit__, None, None, None)

    def test_environment_uses_placeholders_and_preserves_template_settings(self):
        (self.project / ".env.example").write_text(
            "PORT=3124\nSSMUSIC_SERVER_URL=https://old-host/\n"
            "SSMUSIC_API_KEY=example-value\nDB_PASSWORD=postgres\n"
            "# SSMUSIC_CA_CERT_FILE=/app/certs/ssmusic-ca.pem\n",
            encoding="utf-8",
        )
        initialize.create_environment(self.project)
        result = (self.project / ".env").read_text(encoding="utf-8")
        self.assertIn("PORT=3124\n", result)
        for key, value in initialize.PLACEHOLDERS.items():
            self.assertEqual(result.count(f"{key}={value}\n"), 1)
        self.assertNotIn("old-host", result)
        self.assertNotIn("example-value", result)

    def test_existing_environment_is_not_read_printed_or_overwritten(self):
        destination = self.project / ".env"
        destination.write_bytes(b"API_MEMBER_PW=existing-secret\r\n")
        initialize.create_environment(self.project)
        self.assertEqual(destination.read_bytes(), b"API_MEMBER_PW=existing-secret\r\n")
        self.assertNotIn("existing-secret", self.output.getvalue())

    def test_supplied_public_certificate_is_validated_and_copied(self):
        source = self.project / "public.pem"
        source.write_bytes(b"fixture-public-certificate")
        with patch.object(initialize, "validate_public_certificate") as validate:
            initialize.install_certificate(self.project, source, "unused", "/unused")
        validate.assert_called_once_with(b"fixture-public-certificate")
        self.assertEqual(self.certificate.read_bytes(), source.read_bytes())

    def test_docker_exports_only_the_public_certificate(self):
        def export(command, **kwargs):
            self.assertEqual(command[:3], ["docker", "cp", "music:/app/data/tls/server-cert.pem"])
            self.assertTrue(kwargs["check"])
            self.assertEqual(kwargs["timeout"], 30)
            Path(command[3]).write_bytes(b"fixture-public-certificate")

        with patch.object(initialize.shutil, "which", return_value="docker"), \
                patch.object(initialize.subprocess, "run", side_effect=export), \
                patch.object(initialize, "validate_public_certificate"):
            initialize.install_certificate(self.project, None, "music", "/app/data/tls/server-cert.pem")
        self.assertEqual(self.certificate.read_bytes(), b"fixture-public-certificate")

    def test_existing_certificate_is_preserved_without_docker(self):
        self.certificate.parent.mkdir()
        self.certificate.write_bytes(b"existing-public-certificate")
        with patch.object(initialize, "validate_public_certificate") as validate, \
                patch.object(initialize.subprocess, "run") as export:
            initialize.install_certificate(self.project, None, "unused", "/unused")
        export.assert_not_called()
        validate.assert_called_once_with(b"existing-public-certificate")
        self.assertEqual(self.certificate.read_bytes(), b"existing-public-certificate")

    def test_invalid_certificates_and_private_keys_are_not_installed(self):
        source = self.project / "invalid.pem"
        for data in [b"not a certificate", b"-----BEGIN PRIVATE KEY-----\nsecret", b"\xff"]:
            with self.subTest(data=data):
                source.write_bytes(data)
                with self.assertRaises(ValueError):
                    initialize.install_certificate(self.project, source, "unused", "/unused")
                self.assertFalse(self.certificate.exists())

    def test_docker_failure_leaves_no_certificate(self):
        with patch.object(initialize.shutil, "which", return_value="docker"), \
                patch.object(initialize.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "docker")):
            with self.assertRaisesRegex(RuntimeError, "--cert-file"):
                initialize.install_certificate(self.project, None, "missing", "/public.pem")
        self.assertFalse(self.certificate.exists())

    def test_missing_docker_explains_file_option(self):
        with patch.object(initialize.shutil, "which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "--cert-file"):
                initialize.install_certificate(self.project, None, "unused", "/unused")


if __name__ == "__main__":
    unittest.main()