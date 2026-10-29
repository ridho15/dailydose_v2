import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './pemesanan-kelas.service';
import { ReschedulesController } from './reschedules.controller';
import { ReschedulesService } from './ubah-jadwal.service';
import { UlasanInstrukturController } from './ulasan-instruktur.controller';
import { UlasanInstrukturService } from './ulasan-instruktur.service';
import { PembatalanTerlambatService } from './pembatalan-terlambat.service';

@Module({
  imports: [IdentityModule],
  controllers: [BookingsController, ReschedulesController, UlasanInstrukturController],
  providers: [
    BookingsService,
    ReschedulesService,
    UlasanInstrukturService,
    PembatalanTerlambatService,
  ],
})
export class BookingsModule {}
