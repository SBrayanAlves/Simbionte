export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const Errors = {
  invalidCredentials: () =>
    new AppError(401, "invalid_credentials", "Credenciais inválidas"),
  emailInUse: () =>
    new AppError(409, "email_in_use", "E-mail já cadastrado"),
  unauthorized: (message = "Não autenticado") =>
    new AppError(401, "unauthorized", message),
  invalidRefreshToken: () =>
    new AppError(401, "invalid_refresh_token", "Refresh token inválido ou expirado"),
  notFound: (message = "Recurso não encontrado") =>
    new AppError(404, "not_found", message),
  conflict: (code: string, message: string) => new AppError(409, code, message),
  /** Regra de negócio violada (cotas, intervalo mínimo). */
  unprocessable: (code: string, message: string) => new AppError(422, code, message),
};
