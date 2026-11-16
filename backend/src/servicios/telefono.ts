import { z } from 'zod';

/**
 * Celular de Ecuador en el formato que usa WhatsApp: 593 + 9 dígitos.
 * Acepta como lo escriba la persona: 0987654321, 987654321, 593987654321 o +593 98 765 4321.
 */
export function normalizarTelefono(texto: string) {
  const d = texto.replace(/\D/g, '');
  if (d.startsWith('593')) return d;
  if (d.startsWith('0')) return `593${d.slice(1)}`;
  return `593${d}`;
}

export const telefonoSchema = z
  .string()
  .transform(normalizarTelefono)
  .refine((t) => /^593\d{9}$/.test(t), 'Escribe el celular con 9 dígitos, por ejemplo 0987654321');
