import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpenFinanceController } from './open-finance.controller.js';
import { OpenFinanceService } from './open-finance.service.js';
import { BankConsent } from '../database/entities/bank-consent.entity.js';
import { BankToken } from '../database/entities/bank-token.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([BankConsent, BankToken])],
  controllers: [OpenFinanceController],
  providers: [OpenFinanceService],
  exports: [OpenFinanceService],
})
export class OpenFinanceModule {}
