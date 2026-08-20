import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

@ApiTags('Auth')
@Controller(['auth', 'api/auth'])
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Get('register')
  @ApiOperation({
    summary: 'Temporary local testing fallback for register via query params',
  })
  registerViaQuery(
    @Query('id') id?: string,
    @Query('email') email?: string,
    @Query('password') password?: string,
  ) {
    if (!id || !email || !password) {
      throw new BadRequestException(
        'Use POST /auth/register with JSON body, or provide id/email/password query params for local testing',
      );
    }

    return this.authService.register({ id, email, password });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('login')
  @ApiOperation({
    summary: 'Temporary local testing fallback for login via query params',
  })
  loginViaQuery(
    @Query('email') email?: string,
    @Query('password') password?: string,
  ) {
    if (!email || !password) {
      throw new BadRequestException(
        'Use POST /auth/login with JSON body, or provide email/password query params for local testing',
      );
    }

    return this.authService.login({ email, password });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke token' })
  logout() {
    // TODO: implement token revocation
    return { message: 'Logged out successfully' };
  }
}
