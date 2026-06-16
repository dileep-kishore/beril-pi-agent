export type BrandId = "beril" | "phenix";

export interface Brand {
  id: BrandId;
  name: string;
  product: string;
  subtitle: string;
}

export const BRANDS: Record<BrandId, Brand> = {
  beril: {
    id: "beril",
    name: "BERIL",
    product: "BERIL Research Observatory",
    subtitle: "research co-scientist",
  },
  phenix: {
    id: "phenix",
    name: "PHENIX",
    product: "PHENIX",
    subtitle: "structural biology co-scientist",
  },
};

export function brandForTheme(themeName?: string): Brand {
  const normalized = themeName?.trim().toLowerCase();
  if (normalized === "phenix") return BRANDS.phenix;
  return BRANDS.beril;
}
