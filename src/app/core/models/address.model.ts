export interface MapLocation {
  lat: number;
  lng: number;
  label: string;
}

export interface SavedAddress {
  id: string;
  fullName: string;
  mobile: string;
  location: MapLocation | null;
  house: string;
  street: string;
  landmark: string;
  pinCode: string;
  city: string;
  state: string;
  isDefault: boolean;
}

export type AddressDraft = Omit<SavedAddress, 'id'>;
