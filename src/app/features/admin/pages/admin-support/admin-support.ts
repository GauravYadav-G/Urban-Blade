import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupportChatboxComponent } from '../../components/support-chatbox/support-chatbox';

@Component({
  selector: 'app-admin-support',
  standalone: true,
  imports: [CommonModule, SupportChatboxComponent],
  template: `
    <div class="admin-support-page">
      <app-support-chatbox [inline]="true" />
    </div>
  `,
  styles: [`
    .admin-support-page {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
  `],
})
export class AdminSupportPage {}
