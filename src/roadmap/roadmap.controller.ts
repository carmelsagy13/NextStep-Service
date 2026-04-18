import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RoadmapService } from './roadmap.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('Roadmap')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('roadmap')
export class RoadmapController {
  constructor(private readonly roadmapService: RoadmapService) {}

  @Get()
  @ApiOperation({ summary: 'Get current roadmap, progress, and goals' })
  getRoadmap(@CurrentUser() user: { userId: string }) {
    return this.roadmapService.getRoadmap(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Update roadmap state' })
  updateRoadmap(@CurrentUser() user: { userId: string }, @Body() body: any) {
    return this.roadmapService.updateRoadmap(user.userId, body);
  }
}
