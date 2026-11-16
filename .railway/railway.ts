import { defineRailway, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "tastebuds";
export default defineRailway(() => {
  const tastebuds = service("tastebuds", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "node server.js",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    deploy: { drainingSeconds: 30, overlapSeconds: 30, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 5 },
    networking: { privateNetworkEndpoint: "web" },
  });

  return project("TasteBuds", {
    variables: { managed: false },
    resources: [tastebuds],
  });
});
