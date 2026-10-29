import { invalid, text } from './content-validation';

export const FAQ_CONTENT_KEY = 'CLASS_DETAIL_FAQ';
export const FAQ_KIND = 'FAQ';
const MAX_ITEMS = 50;
const MIN_TEXT = 5;

/**
 * Validasi + normalisasi FAQ halaman detail kelas. Teks ditampilkan apa adanya oleh situs (bukan HTML),
 * jadi cukup dibatasi panjangnya. Minimal satu butir; untuk kembali ke FAQ bawaan, arsipkan kontennya.
 */
export function validateFaq(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('payload');
  const { items } = payload as Record<string, unknown>;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) throw invalid('items');

  return {
    items: items.map((raw, index) => {
      if (!raw || typeof raw !== 'object') throw invalid(`items[${index}]`);
      const item = raw as Record<string, unknown>;
      const field = (name: string) => `items[${index}].${name}`;
      const question = text(item.question, field('question'), 200, true)!;
      const answer = text(item.answer, field('answer'), 1500, true)!;
      if (question.length < MIN_TEXT) throw invalid(field('question'), 'TOO_SHORT');
      if (answer.length < MIN_TEXT) throw invalid(field('answer'), 'TOO_SHORT');
      return {
        id: text(item.id, field('id'), 64) ?? `faq-${index + 1}`,
        question,
        answer,
        order: index + 1,
      };
    }),
  };
}

/** FAQ tampil di halaman publik berbahasa Indonesia. */
export const FAQ_LOCALE = 'id-ID';
