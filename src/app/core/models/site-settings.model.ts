export interface SiteAnnouncement {
  enabled: boolean;
  badge: string;
  text: string;
  linkText: string;
  linkUrl: string;
}

export interface SiteBusiness {
  name: string;
  tagline: string;
  phoneDisplay: string;
  phoneTel: string;
  email: string;
  address: string;
  city: string;
  pin: string;
  hours: string;
  mapsUrl: string;
}

export interface SiteEcommerce {
  freeShippingThreshold: number;
  standardShippingFee: number;
  taxRatePercent: number;
  currency: string;
}

export interface SiteOperations {
  chairCount: number;
  acceptingOrders: boolean;
  emergencyNotice: string;
}

export interface SiteSettings {
  announcement: SiteAnnouncement;
  business: SiteBusiness;
  ecommerce: SiteEcommerce;
  operations: SiteOperations;
}
