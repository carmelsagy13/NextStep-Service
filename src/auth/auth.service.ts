import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { InMemoryAuthUserStore } from './in-memory-auth-user.store.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly userStore: InMemoryAuthUserStore,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.userStore.findByEmail(dto.email);
    if (exists) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.userStore.create(dto.email, passwordHash);

    const accessToken = this.jwtService.sign({ sub: user.userId, email: user.email });
    return { accessToken, userId: user.userId };
  }

  async login(dto: LoginDto) {
    const user = await this.userStore.findByEmail(dto.email);
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.jwtService.sign({ sub: user.userId, email: user.email });
    return { accessToken, userId: user.userId };
  }
}
