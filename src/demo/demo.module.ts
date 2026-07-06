import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DemoController } from './demo.controller.js';
import { DemoService } from './demo.service.js';
import { User } from '../database/entities/user.entity.js';
import { UserProfile } from '../database/entities/user-profile.entity.js';
import { OpenFinanceModule } from '../open-finance/open-finance.module.js';
import { AspirationsModule } from '../aspirations/aspirations.module.js';

/**
 * Demo Mode module.
 *
 * Exposes POST /demo/trigger — a single JWT-protected endpoint that drives an
 * automated demo presentation without requiring the user to manually upload a
 * file or enter an ID in a form.
 *
 * Activation: set the DEMO_MODE environment variable to "true".
 * Demo data:  set DEMO_DATA_PATH to the JSON file path (default: myData.json).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserProfile]),
    OpenFinanceModule,
    AspirationsModule,
  ],
  controllers: [DemoController],
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule {}
