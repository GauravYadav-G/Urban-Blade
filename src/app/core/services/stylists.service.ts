import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
export interface Stylist {id:string;name:string;role:string;is_active:boolean;}
@Injectable({providedIn:'root'})
export class StylistsService {
  private readonly http=inject(HttpClient);
  list(){return this.http.get<{data:Stylist[]}>('/api/admin/stylists');}
  save(id:string|null,value:Omit<Stylist,'id'>){return id?this.http.put<Stylist>(`/api/admin/stylists/${id}`,value):this.http.post<Stylist>('/api/admin/stylists',value);}
  remove(id:string){return this.http.delete(`/api/admin/stylists/${id}`);}
}
