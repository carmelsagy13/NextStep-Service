import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AspirationsService } from './aspirations.service.js';
import { CreateAspirationDto } from './dto/create-aspiration.dto.js';
import { UpdateAspirationDto } from './dto/update-aspiration.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@ApiTags('Aspirations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('aspirations')
export class AspirationsController {
  constructor(private readonly aspirationsService: AspirationsService) {}

  @Get('types')
  @ApiOperation({
    summary: 'List the active goal types a user can declare (data-driven catalog)',
  })
  getGoalTypes() {
    return this.aspirationsService.getGoalTypes();
  }

  @Get()
  @ApiOperation({ summary: "Get the current user's overarching goals (aspirations)" })
  getAspirations(@CurrentUser() user: { userId: string }) {
    return this.aspirationsService.getAspirations(user.userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create an overarching goal; triggers an immediate task re-sync',
  })
  createAspiration(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateAspirationDto,
  ) {
    return this.aspirationsService.createAspiration(user.userId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update an overarching goal; a material change re-tunes the linked roadmap tasks',
  })
  updateAspiration(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: UpdateAspirationDto,
  ) {
    return this.aspirationsService.updateAspiration(user.userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Abandon (soft-delete) an overarching goal' })
  abandonAspiration(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
  ) {
    return this.aspirationsService.abandonAspiration(user.userId, id);
  }
}
