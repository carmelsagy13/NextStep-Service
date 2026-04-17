import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type AuthUserRecord = {
  userId: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
};

@Injectable()
export class InMemoryAuthUserStore {
  private readonly usersById = new Map<string, AuthUserRecord>();
  private readonly usersByEmail = new Map<string, AuthUserRecord>();

  async findByEmail(email: string): Promise<AuthUserRecord | null> {
    return this.usersByEmail.get(email) ?? null;
  }

  async findById(userId: string): Promise<AuthUserRecord | null> {
    return this.usersById.get(userId) ?? null;
  }

  async create(email: string, passwordHash: string): Promise<AuthUserRecord> {
    const user: AuthUserRecord = {
      userId: randomUUID(),
      email,
      passwordHash,
      createdAt: new Date(),
    };

    this.usersById.set(user.userId, user);
    this.usersByEmail.set(user.email, user);

    return user;
  }
}