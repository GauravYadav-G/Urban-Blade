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

export function formatStreetAddress(address: Pick<SavedAddress, 'house' | 'street' | 'landmark'>): string {
  return [address.house, address.street, address.landmark].map(part => part.trim()).filter(Boolean).join(', ');
}

export function formatFullAddress(address: SavedAddress): string {
  return [formatStreetAddress(address), address.city, `${address.state} ${address.pinCode}`].filter(Boolean).join(', ');
}
