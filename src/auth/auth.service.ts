import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { User } from '../database/entities/user.entity.js';
import { DemoService, DemoTriggerResult } from '../demo/demo.service.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly demo: DemoService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.userRepo.findOne({
      where: [{ email: dto.email }, { id: dto.id }],
    });
    if (exists) {
      throw new ConflictException(
        exists.email === dto.email
          ? 'Email already registered'
          : 'ID already registered',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.userRepo.save(
      this.userRepo.create({ id: dto.id, email: dto.email, passwordHash }),
    );

    const accessToken = this.jwtService.sign({
      sub: user.userId,
      email: user.email,
    });
    return {
      accessToken,
      userId: user.userId,
      id: user.id,
      email: user.email,
      demoMode: this.isDemoMode(),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.jwtService.sign({
      sub: user.userId,
      email: user.email,
    });

    const base = {
      accessToken,
      userId: user.userId,
      id: user.id,
      email: user.email,
      demoMode: this.isDemoMode(),
    };

    // Every LOGIN re-runs the FULL LLM pipeline (overwriting any existing
    // roadmap/goals) and returns the result inline so the client can render the
    // fresh roadmap immediately. In Demo Mode the data comes from the local
    // DEMO_DATA_PATH file; otherwise it is pulled live from Open Finance using
    // the user's national ID. Session REFRESH uses POST /demo/trigger instead.
    let loginAnalysis: DemoTriggerResult | undefined;
    try {
      loginAnalysis = await this.demo.runLoginAnalysis(user.userId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Non-fatal: log and continue so the client still gets its JWT
      this.logger.warn(
        `Login analysis failed for userId=${user.userId}: ${msg}`,
      );
    }

    return { ...base, loginAnalysis };
  }

  private isDemoMode(): boolean {
    return this.config.get<string>('DEMO_MODE', '').toLowerCase() === 'true';
  }
}
