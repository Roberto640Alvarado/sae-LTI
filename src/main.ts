/*import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupLti } from './lti/lti-setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  await app.listen(process.env.PORT || 3000);
  console.log(`🚀 NestJS iniciado en ${process.env.PORT || 3000}`);

  await setupLti();

}
bootstrap(); */



import { setupLti } from './lti/lti-setup';

async function bootstrap() {
  await setupLti(); // Solo inicia LTI
}
bootstrap();
