import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { type Observable, map } from 'rxjs';

export interface Stylist {
  id: string;
  name: string;
  role: string;
  is_active: boolean;
}

export interface PermanentStylistDeletion {
  ok: boolean;
  deleted: boolean;
  id: string;
  unassignedBookings: number;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class StylistsService {
  private readonly http = inject(HttpClient);

  list(): Observable<{ data: Stylist[] }> {
    return this.http.get<{ data: Stylist[] }>('/api/admin/stylists').pipe(map(response => {
      if (!Array.isArray(response?.data) || response.data.some(stylist =>
        !stylist || typeof stylist.id !== 'string' || typeof stylist.name !== 'string' ||
        typeof stylist.role !== 'string' || typeof stylist.is_active !== 'boolean')) {
        throw new Error('Invalid stylist directory');
      }
      return response;
    }));
  }

  save(id: string | null, value: Omit<Stylist, 'id'>): Observable<Stylist> {
    return id
      ? this.http.put<Stylist>(`/api/admin/stylists/${encodeURIComponent(id)}`, value)
      : this.http.post<Stylist>('/api/admin/stylists', value);
  }

  archive(id: string): Observable<{ ok: boolean; archived: boolean }> {
    return this.http.delete<{ ok: boolean; archived: boolean }>(`/api/admin/stylists/${encodeURIComponent(id)}`);
  }

  deletePermanently(id: string, confirmationName: string): Observable<PermanentStylistDeletion> {
    return this.http.delete<PermanentStylistDeletion>(
      `/api/admin/stylists/${encodeURIComponent(id)}/permanent`,
      { body: { confirmationName } }
    ).pipe(map(response => {
      if (response?.ok !== true || response.deleted !== true || response.id !== id ||
        !Number.isInteger(response.unassignedBookings) || response.unassignedBookings < 0) {
        throw new Error('Stylist deletion was not confirmed');
      }
      return response;
    }));
  }
}
