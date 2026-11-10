export type PipeStatus = "in_use" | "stored" | "archived";
export interface Pipe {
  id: string;
  brand: string;
  model: string;
  shape?: string;
  material?: string;
  filter?: string;
  status?: string;
  date?: string;
  price?: number | null;
  notes?: string;
  photo?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}
