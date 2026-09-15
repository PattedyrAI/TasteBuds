import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async redirects() {
    return [{source:'/:path*',has:[{type:'host',value:'web-production-00050.up.railway.app'}],destination:'https://tastebuds-production-1b73.up.railway.app/:path*',permanent:true}];
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" }
    ] },{source:'/sw.js',headers:[
      {key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},
      {key:'Content-Security-Policy',value:"default-src 'self'; script-src 'self'"}
    ]}];
  }
};
export default config;
