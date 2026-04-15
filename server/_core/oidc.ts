import { jwtVerify } from "jose";

export async function verifyOidcJwt(
  token: string,
  params: {
    audience: string;
    issuer: string;
    jwks: Parameters<typeof jwtVerify>[1];
  }
) {
  return jwtVerify(token, params.jwks, {
    algorithms: ["RS256"],
    issuer: params.issuer,
    audience: params.audience,
  });
}

