/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["ssh2"],
  allowedDevOrigins: ["server-manager.apps.test"],
};

module.exports = nextConfig;
