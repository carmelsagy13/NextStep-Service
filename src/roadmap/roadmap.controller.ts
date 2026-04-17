import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RoadmapService } from './roadmap.service.js';

@ApiTags('Roadmap')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('roadmap')
export class RoadmapController {
  constructor(private readonly roadmapService: RoadmapService) {}

  @Get()
  @ApiOperation({ summary: 'Get current roadmap, progress, and goals' })
  getRoadmap() {
    // TODO: extract userId from JWT
    return this.roadmapService.getRoadmap('placeholder-user-id');
  }

  @Post()
  @ApiOperation({ summary: 'Update roadmap state' })
  updateRoadmap(@Body() body: any) {
    // TODO: extract userId from JWT
    return this.roadmapService.updateRoadmap('placeholder-user-id', body);
  }
}
