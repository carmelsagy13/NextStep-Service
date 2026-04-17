import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { EventDetectionService } from './event-detection.service.js';

@ApiTags('Event Detection')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('events')
export class EventDetectionController {
  constructor(private readonly eventDetectionService: EventDetectionService) {}

  @Get()
  @ApiOperation({ summary: 'Get recent detected financial events' })
  getEvents() {
    // TODO: extract userId from JWT
    return this.eventDetectionService.getEvents('placeholder-user-id');
  }
}
