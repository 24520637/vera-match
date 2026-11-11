import { HealthController } from './health.controller';
describe('HealthController', () => {
  it('reports scaffold process health', () => {
    expect(new HealthController().health()).toEqual({ service: 'vera-api', status: 'ok', implementation: 'scaffold' });
  });
});
