import type { NextConfig } from "next";

/** High-entropy Client Hints the server asks for, so /api/analyze can cross-check them. */
const ACCEPT_CH = [
  "Sec-CH-UA-Model",
  "Sec-CH-UA-Platform-Version",
  "Sec-CH-UA-Arch",
  "Sec-CH-UA-Bitness",
  "Sec-CH-UA-Full-Version-List",
  "Sec-CH-UA-Form-Factors",
  "Sec-CH-UA-WoW64",
  "Sec-CH-Device-Memory",
  "Device-Memory",
  "Sec-CH-DPR",
  "Sec-CH-Viewport-Width",
  "ECT",
  "RTT",
  "Downlink",
].join(", ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  // Testing on a phone over the LAN during `next dev`: DEV_ORIGINS=192.168.1.20,my-tunnel.example
  allowedDevOrigins: process.env.DEV_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Accept-CH", value: ACCEPT_CH },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self)",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/mediapipe/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/models/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
