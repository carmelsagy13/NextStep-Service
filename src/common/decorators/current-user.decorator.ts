import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (
    _data: unknown,
    ctx: ExecutionContext,
  ): { userId: string; email: string } => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
