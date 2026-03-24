import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ZodValidationPipe } from 'nestjs-zod';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TokensService } from './tokens.service';
import { CreateTokenDto, CreateTokenResponseDto, createTokenSchema } from './dto/create-token.dto';
import { TokenListQueryDto, TokenListResponseDto, tokenListQuerySchema } from './dto/token-list-query.dto';

@ApiTags('Personal Access Tokens')
@Controller('tokens')
@Auth()
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new personal access token' })
  @ApiResponse({ status: 201, description: 'Token created. The JWT value is returned only once.' })
  async create(
    @Body(new ZodValidationPipe(createTokenSchema)) dto: CreateTokenDto,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: CreateTokenResponseDto }> {
    const result = await this.tokensService.create(userId, dto);
    return { data: result };
  }

  @Get()
  @ApiOperation({ summary: 'List personal access tokens' })
  async list(
    @Query(new ZodValidationPipe(tokenListQuerySchema)) query: TokenListQueryDto,
    @CurrentUser('id') userId: string,
  ): Promise<{ data: TokenListResponseDto }> {
    const result = await this.tokensService.list(userId, query);
    return { data: result };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a personal access token' })
  @ApiResponse({ status: 204, description: 'Token revoked' })
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.tokensService.revoke(userId, id);
  }
}
