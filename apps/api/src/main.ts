import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true });
  const config = new DocumentBuilder().setTitle('VERA Match API — scaffold').setVersion('0.1.0').build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(Number(process.env.API_PORT || 4000));
}
bootstrap().catch((err) => { console.error(err); process.exit(1); });
