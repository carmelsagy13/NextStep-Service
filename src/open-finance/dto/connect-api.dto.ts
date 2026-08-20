import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectApiDto {
  @ApiProperty({
    description:
      'External user identifier registered with the Open Finance provider',
    example: 'user-1772268',
  })
  @IsString()
  @IsNotEmpty()
  externalUserId!: string;
}
