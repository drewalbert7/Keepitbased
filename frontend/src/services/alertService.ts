import axios from 'axios';
import { Alert, AlertHistory, CreateAlertRequest, UpdateAlertRequest, PaginatedResponse } from '../types';

class AlertService {
  async createAlert(alertData: CreateAlertRequest): Promise<Alert> {
    const response = await axios.post<Alert>('/alerts', alertData);
    return response.data;
  }

  async getAlerts(): Promise<Alert[]> {
    const response = await axios.get<Alert[]>('/alerts');
    return response.data;
  }

  async updateAlert(id: number, updates: UpdateAlertRequest): Promise<Alert> {
    const response = await axios.put<Alert>(`/alerts/${id}`, updates);
    return response.data;
  }

  async deleteAlert(id: number): Promise<void> {
    await axios.delete(`/alerts/${id}`);
  }

  async getAlertHistory(page = 1, limit = 20): Promise<PaginatedResponse<AlertHistory>> {
    const response = await axios.get<PaginatedResponse<AlertHistory>>('/alerts/history', {
      params: { page, limit }
    });
    return response.data;
  }

  async toggleAlert(id: number, active: boolean): Promise<Alert> {
    return this.updateAlert(id, { active });
  }

  async updateThresholds(
    id: number, 
    thresholds: {
      smallThreshold?: number;
      mediumThreshold?: number;
      largeThreshold?: number;
    }
  ): Promise<Alert> {
    return this.updateAlert(id, thresholds);
  }
}

export const alertService = new AlertService();